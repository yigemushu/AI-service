type SectionProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

export function Section({ title, description, children }: SectionProps) {
  return (
    <section className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-lg shadow-slate-200/60 ring-1 ring-slate-100/80 backdrop-blur sm:p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-slate-950">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
