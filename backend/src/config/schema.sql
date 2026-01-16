CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  username text UNIQUE NOT NULL,
  password text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'dev', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Nginx Visual Manager Tables

CREATE TABLE IF NOT EXISTS nginx_servers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  primary_domain VARCHAR(255) NOT NULL UNIQUE,
  additional_domains TEXT[] DEFAULT '{}',
  upstream_servers JSONB DEFAULT '[]',
  server_type VARCHAR(50) NOT NULL DEFAULT 'proxy' CHECK (server_type IN ('proxy', 'balancer', 'static')),
  listen_port INTEGER DEFAULT 80,
  ssl_type VARCHAR(50) DEFAULT 'none' CHECK (ssl_type IN ('none', 'letsencrypt', 'manual')),
  ssl_cert_path VARCHAR(500),
  ssl_key_path VARCHAR(500),
  proxy_host VARCHAR(255) DEFAULT 'localhost',
  proxy_port INTEGER DEFAULT 3000,
  root_path VARCHAR(500) DEFAULT '/var/www/html',
  websocket_enabled BOOLEAN DEFAULT true,
  forward_headers BOOLEAN DEFAULT true,
  client_max_body_size VARCHAR(20) DEFAULT '50m',
  proxy_connect_timeout VARCHAR(20) DEFAULT '5s',
  proxy_read_timeout VARCHAR(20) DEFAULT '60s',
  proxy_send_timeout VARCHAR(20) DEFAULT '60s',
  is_active BOOLEAN DEFAULT true,
  config_file_path VARCHAR(500),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nginx_logs (
  id SERIAL PRIMARY KEY,
  server_id INTEGER REFERENCES nginx_servers(id) ON DELETE CASCADE,
  client_ip VARCHAR(45),
  request_method VARCHAR(10),
  request_path TEXT,
  status_code INTEGER,
  response_time_ms INTEGER,
  bytes_sent INTEGER,
  user_agent TEXT,
  referer TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nginx_logs_server_timestamp ON nginx_logs(server_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_nginx_logs_status ON nginx_logs(status_code);
CREATE INDEX IF NOT EXISTS idx_nginx_logs_timestamp ON nginx_logs(timestamp DESC);

CREATE TABLE IF NOT EXISTS nginx_ssl_certs (
  id SERIAL PRIMARY KEY,
  server_id INTEGER REFERENCES nginx_servers(id) ON DELETE CASCADE,
  domain VARCHAR(255) NOT NULL UNIQUE,
  cert_path VARCHAR(500),
  key_path VARCHAR(500),
  issuer VARCHAR(100) DEFAULT 'Unknown',
  expires_at TIMESTAMPTZ,
  auto_renew BOOLEAN DEFAULT true,
  last_renewed TIMESTAMPTZ,
  next_renewal TIMESTAMPTZ,
  status VARCHAR(50) DEFAULT 'unknown' CHECK (status IN ('valid', 'expiring_soon', 'expired', 'unknown')),
  fingerprint VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nginx_ssl_certs_domain ON nginx_ssl_certs(domain);
CREATE INDEX IF NOT EXISTS idx_nginx_ssl_certs_expires ON nginx_ssl_certs(expires_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_nginx_server_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS nginx_servers_updated_at ON nginx_servers;
CREATE TRIGGER nginx_servers_updated_at
  BEFORE UPDATE ON nginx_servers
  FOR EACH ROW
  EXECUTE FUNCTION update_nginx_server_timestamp();
