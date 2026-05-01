import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'EssentiallySports MCP Server',
  description: 'Model Context Protocol server for EssentiallySports — image search and content tools',
  icons: {
    icon: '/favicon.png',
    apple: '/icon-152.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
