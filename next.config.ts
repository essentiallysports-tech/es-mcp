import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@modelcontextprotocol/sdk'],
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
