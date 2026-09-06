import { Link } from 'react-router-dom';

export function Landing() {
  return (
    <section className="py-16 text-center">
      <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
        Let AI agents spend money. <span className="text-violet-400">Safely and privately.</span>
      </h1>
      <p className="mt-5 text-slate-400 max-w-2xl mx-auto">
        Fund a non-custodial vault, set private spending rules, and hire services on Stellar. This
        is the next-generation CleverCon app, built to scale.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Link
          to="/connect"
          className="rounded-xl bg-violet-600 hover:bg-violet-500 px-5 py-2.5 font-semibold"
        >
          Launch app
        </Link>
        <a
          href="https://github.com/clevercon-protocol/clevercon"
          className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-5 py-2.5"
        >
          GitHub
        </a>
      </div>
    </section>
  );
}
