export default function Home() {
  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem', maxWidth: '600px', margin: 'auto' }}>
      <h1>EssentiallySports MCP Server</h1>
      <p>Model Context Protocol endpoint for Claude and other AI assistants.</p>
      <h2>Tools</h2>
      <ul>
        <li><strong>search_images</strong> — Search 5M+ sports images from the ES media library</li>
      </ul>
      <h2>Endpoint</h2>
      <code>/mcp</code>
      <p>Connect via Claude Desktop or any MCP-compatible client.</p>
    </main>
  );
}
