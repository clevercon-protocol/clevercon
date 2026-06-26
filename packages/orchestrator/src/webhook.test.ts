import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateWebhookUrl, sendWebhookWithRetry } from './server.js';

describe('validateWebhookUrl', () => {
  it('returns true if undefined', () => {
    expect(validateWebhookUrl(undefined)).toBe(true);
  });

  it('returns false if not a string', () => {
    expect(validateWebhookUrl(123)).toBe(false);
    expect(validateWebhookUrl(null)).toBe(false);
    expect(validateWebhookUrl({})).toBe(false);
  });

  it('returns true for valid public http/https URLs', () => {
    expect(validateWebhookUrl('https://example.com/webhook')).toBe(true);
    expect(validateWebhookUrl('http://142.250.190.46/webhook')).toBe(true);
  });

  it('returns false for invalid or unsupported protocol URLs', () => {
    expect(validateWebhookUrl('ftp://example.com')).toBe(false);
    expect(validateWebhookUrl('not-a-url')).toBe(false);
  });

  it('rejects loopback and private IPs in production mode', () => {
    const originalVitest = process.env.VITEST;
    const originalNodeEnv = process.env.NODE_ENV;
    
    // Temporarily remove test/dev environment bypass flags
    delete process.env.VITEST;
    process.env.NODE_ENV = 'production';

    try {
      expect(validateWebhookUrl('http://localhost:3000')).toBe(false);
      expect(validateWebhookUrl('http://127.0.0.1:3000')).toBe(false);
      expect(validateWebhookUrl('http://10.0.0.1')).toBe(false);
      expect(validateWebhookUrl('http://192.168.1.1')).toBe(false);
      expect(validateWebhookUrl('http://172.16.0.1')).toBe(false);
      expect(validateWebhookUrl('http://169.254.169.254')).toBe(false);
      expect(validateWebhookUrl('http://[::1]')).toBe(false);
      expect(validateWebhookUrl('http://[fe80::1]')).toBe(false);
      expect(validateWebhookUrl('http://[fc00::1]')).toBe(false);
    } finally {
      process.env.VITEST = originalVitest;
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('allows loopback and private IPs in dev/test mode', () => {
    // Under vitest, process.env.VITEST is set
    expect(validateWebhookUrl('http://localhost:3000')).toBe(true);
    expect(validateWebhookUrl('http://127.0.0.1:3000')).toBe(true);
    expect(validateWebhookUrl('http://10.0.0.1')).toBe(true);
  });
});

describe('sendWebhookWithRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('successfully delivers webhook payload on 2xx status', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('ok'),
    } as Response);

    const payload = { task_id: 'test-123', status: 'completed' };
    await sendWebhookWithRetry('http://example.com/webhook?token=secret123', payload);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://example.com/webhook?token=secret123',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook delivered to http://example.com with HTTP status 200'),
    );
  });

  it('retries once on HTTP 500 status and then succeeds on retry', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // First call returns 500, second call returns 200
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        status: 500,
        text: () => Promise.resolve('error'),
      } as Response)
      .mockResolvedValueOnce({
        status: 200,
        text: () => Promise.resolve('ok'),
      } as Response);

    const payload = { task_id: 'test-500', status: 'completed' };
    await sendWebhookWithRetry('http://example.com/webhook', payload);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook delivery failed (HTTP status: 500). Retrying once…'),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook delivered to http://example.com with HTTP status 200'),
    );
  });

  it('retries once on network error and fails', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const payload = { task_id: 'test-network', status: 'failed' };
    await sendWebhookWithRetry('http://example.com/webhook', payload);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook delivery failed (error: fetch failed). Retrying once…'),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook delivery failed to http://example.com: fetch failed'),
    );
  });

  it('retries once and logs failure on permanent HTTP 500 status (retry exhaustion)', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      status: 500,
      text: () => Promise.resolve('error'),
    } as Response);

    const payload = { task_id: 'test-exhaustion', status: 'completed' };
    await sendWebhookWithRetry('http://example.com/webhook', payload);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook delivery failed (HTTP status: 500). Retrying once…'),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook delivery failed to http://example.com: HTTP status 500'),
    );
  });
});
