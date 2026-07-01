import Link from "next/link";

export function TopBar({
  ownerEmail,
  active,
}: {
  ownerEmail: string;
  active: "generator" | "writers" | "prompts" | "followup";
}) {
  const linkCls = (key: string) =>
    `rounded px-2.5 py-1 transition-colors ${
      active === key
        ? "bg-white/12 text-white"
        : "text-white/65 hover:bg-white/[0.06] hover:text-white"
    }`;

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-brand-dark">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <div className="flex items-center gap-5">
          <Link href="/" className="flex items-center gap-3" aria-label="Activant — DEFROST home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/activant-logo-white.png"
              alt="Activant"
              width={888}
              height={150}
              className="h-[20px] w-auto"
            />
            <span className="h-4 w-px bg-white/20" aria-hidden />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-white/70">
              DEFROST
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/" className={linkCls("generator")}>
              Generator
            </Link>
            <Link href="/writers" className={linkCls("writers")}>
              Writers
            </Link>
            <Link href="/prompts" className={linkCls("prompts")}>
              Prompts
            </Link>
            <Link href="/follow-up" className={linkCls("followup")}>
              Follow-Up
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-white/45 sm:inline">
            owner: <span className="text-white/80">{ownerEmail}</span>
          </span>
          <form action="/auth/signout" method="post">
            <button
              className="rounded border border-white/20 px-3 py-1 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
