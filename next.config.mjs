import { withWorkflow } from 'workflow/next'
import { fileURLToPath } from 'node:url'

const xdgAppPathsShim = fileURLToPath(
  new URL('./lib/sonar/xdg-app-paths-shim.cjs', import.meta.url)
)

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  webpack(config) {
    config.resolve.alias['xdg-app-paths'] = xdgAppPathsShim
    return config
  },
};

export default withWorkflow(nextConfig);
