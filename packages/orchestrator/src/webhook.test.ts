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

  it('returns true for valid http/https URLs', () => {
    expect(validateWebhookUrl('http://localhost:3000')).toBe(true);
    expect(validateWebhookUrl('https://example.com/webhook')).toBe(true);
  });

  it('returns false for invalid or unsupported protocol URLs', () => {
    expect(validateWebhookUrl('ftp://example.com')).toBe(false);
    expect(validateWebhookUrl('not-a-url')).toBe(false);
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
    await sendWebhookWithRetry('http://example.com/webhook', payload);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Webhook delivered to http://example.com/webhook with HTTP status 200',
      ),
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
      expect.stringContaining(
        'Webhook delivered to http://example.com/webhook with HTTP status 200',
      ),
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
      expect.stringContaining('Webhook delivery failed after retrying: fetch failed'),
    );
  });
});
