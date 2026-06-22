export const metadata = {
  title: "Calendar Mirror Webhook",
  description: "Event-driven Google Calendar busy-block mirror",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
