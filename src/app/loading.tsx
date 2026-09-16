export default function Loading() {
  return <main className="route-loading" role="status" aria-live="polite" aria-label="Loading FYNTA">
    <span className="route-spinner" aria-hidden="true" />
    <p>Loading workspace…</p>
  </main>;
}
