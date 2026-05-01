export default function Home() {
  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem', maxWidth: '600px', margin: 'auto' }}>
      <img src="/favicon.png" alt="EssentiallySports" style={{ width: 48, height: 48, marginBottom: '0.75rem', display: 'block' }} />
      <h1>EssentiallySports MCP Server</h1>
      <p>Model Context Protocol endpoint for Claude and other AI assistants.</p>
      <h2>Tools</h2>
      <ul>
        <li><strong>search_images</strong> — Search 5M+ sports images from the ES media library</li>
      </ul>
      <h2>Endpoint</h2>
      <code>https://mcp.essentiallysports.com/mcp</code>
      <h2>Claude Desktop config</h2>
      <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '4px', overflow: 'auto' }}>{`{
  "mcpServers": {
    "essentiallysports": {
      "url": "https://mcp.essentiallysports.com/mcp"
    }
  }
}`}</pre>
      <p>Connect via Claude Desktop or any MCP-compatible client.</p>
    </main>
  );
}
