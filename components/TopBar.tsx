import Link from "next/link";

export function TopBar({
  ownerEmail,
  active,
}: {
  ownerEmail: string;
  active: "generator" | "writers" | "prompts";
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-tight text-ink">
              Cold Outreach
            </span>
            <span className="eyebrow">generator</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/"
              className={`rounded px-2.5 py-1 transition-colors ${
                active === "generator"
                  ? "bg-accent-soft text-accent-ink"
                  : "text-ink-soft hover:bg-accent-soft/60"
              }`}
            >
              Generator
            </Link>
            <Link
              href="/writers"
              className={`rounded px-2.5 py-1 transition-colors ${
                active === "writers"
                  ? "bg-accent-soft text-accent-ink"
                  : "text-ink-soft hover:bg-accent-soft/60"
              }`}
            >
              Writers
            </Link>
            <Link
              href="/prompts"
              className={`rounded px-2.5 py-1 transition-colors ${
                active === "prompts"
                  ? "bg-accent-soft text-accent-ink"
                  : "text-ink-soft hover:bg-accent-soft/60"
              }`}
            >
              Prompts
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-ink-faint sm:inline">
            owner: <span className="text-ink-soft">{ownerEmail}</span>
          </span>
          <form action="/auth/signout" method="post">
            <button className="btn btn-ghost py-1 text-xs" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
