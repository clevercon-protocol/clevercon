export function Placeholder({ title, blurb }: { title: string; blurb: string }) {
  return (
    <section>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-slate-400 max-w-2xl">{blurb}</p>
      <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-6 text-slate-500 text-sm">
        Coming soon. This console is scaffolded and will be built out on the new API.
      </div>
    </section>
  );
}
