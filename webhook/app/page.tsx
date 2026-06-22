export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 40, lineHeight: 1.5 }}>
      <h1>Calendar Mirror Webhook</h1>
      <p>
        Event-driven service that mirrors personal calendar events onto a target
        calendar as private busy-blocks. No UI — it runs via a Google push
        webhook and a daily renewal cron.
      </p>
      <ul>
        <li>
          <code>POST /api/calendar-webhook</code> — Google push receiver
        </li>
        <li>
          <code>GET /api/cron/renew-watch</code> — re-register channel (cron / manual, Bearer-protected)
        </li>
        <li>
          <code>GET /api/health</code> — current channel + sync state
        </li>
      </ul>
    </main>
  );
}
