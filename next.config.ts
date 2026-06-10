import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Website HTML fetching happens in server routes; no special config needed.
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
