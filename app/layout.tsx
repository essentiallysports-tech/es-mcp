export const metadata = {
  title: 'EssentiallySports MCP Server',
  description: 'Model Context Protocol server for EssentiallySports — image search and content tools',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
