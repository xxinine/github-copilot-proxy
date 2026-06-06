// Manages the lifecycle of one copilot-proxy-api container per bound account.
// This is "route 1": every GitHub account gets its own upstream proxy process,
// all sharing the same image. Containers are siblings on the host Docker daemon
// (docker.sock is mounted) and join the shared CPX network so the gateway can
// reach them by container name.

import Docker from 'dockerode';

const docker = new Docker();

function image(): string {
  return process.env.CPX_PROXY_IMAGE || 'ghcr.io/voidsteed/copilot-proxy-api:latest';
}
function network(): string {
  return process.env.CPX_DOCKER_NETWORK || 'cpx-net';
}
function proxyPort(): string {
  return process.env.CPX_PROXY_PORT || '4141';
}

export function containerNameFor(accountId: number): string {
  return `cpx-acct-${accountId}`;
}

export async function ensureImage(): Promise<void> {
  const ref = image();
  const images = await docker.listImages({ filters: { reference: [ref] } });
  if (images.length > 0) return;
  await new Promise<void>((resolve, reject) => {
    docker.pull(ref, (err: unknown, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err as Error);
      docker.modem.followProgress(stream, (e: unknown) => (e ? reject(e as Error) : resolve()));
    });
  });
}

async function removeIfExists(name: string): Promise<void> {
  try {
    const c = docker.getContainer(name);
    await c.remove({ force: true });
  } catch {
    // not found — fine
  }
}

/** (Re)create and start the proxy container for an account. Returns its name. */
export async function startAccountContainer(
  accountId: number,
  ghToken: string
): Promise<string> {
  const name = containerNameFor(accountId);
  await removeIfExists(name);
  const container = await docker.createContainer({
    name,
    Image: image(),
    Env: [`GH_TOKEN=${ghToken}`],
    Cmd: ['start', '--port', proxyPort()],
    Labels: { 'cpx.managed': 'true', 'cpx.account': String(accountId) },
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped' },
      NetworkMode: network(),
    },
  });
  await container.start();
  return name;
}

export async function stopAccountContainer(accountId: number): Promise<void> {
  await removeIfExists(containerNameFor(accountId));
}

export async function containerRunning(accountId: number): Promise<boolean> {
  try {
    const info = await docker.getContainer(containerNameFor(accountId)).inspect();
    return info.State?.Running === true;
  } catch {
    return false;
  }
}

/** Ensure the shared network exists (idempotent). */
export async function ensureNetwork(): Promise<void> {
  const net = network();
  const nets = await docker.listNetworks({ filters: { name: [net] } });
  if (nets.some((n) => n.Name === net)) return;
  await docker.createNetwork({ Name: net, Driver: 'bridge' });
}
