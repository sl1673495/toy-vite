console.log('[vite] connecting...');

const host = location.host;
const socket = new WebSocket(`ws://${host}`, 'vite-hmr');

socket.addEventListener('message', async ({ data }) => {
  handleMessage(JSON.parse(data)).catch(console.error);
});

interface Update {
  type: 'js-update' | 'css-update';
  path: string;
  acceptedPath: string;
  timestamp: number;
}

async function handleMessage(payload: any) {
  switch (payload.type) {
    case 'connected':
      console.log(`[vite] connected.`);
      // proxy(nginx, docker) hmr ws maybe caused timeout,
      // so send ping package let ws keep alive.
      setInterval(() => socket.send('ping'), 30000);
      break;

    case 'update':
      payload.updates.forEach((update: Update) => {
        if (update.type === 'js-update') {
          // TODO
          fetchUpdate(update);
        } else {
          // css-update
          // this is only sent when a css file referenced with <link> is updated
        }
      });
      break;
  }
}

interface HotModule {
  id: string;
  callbacks: HotCallback[];
}

interface HotCallback {
  // the dependencies must be fetchable paths
  deps: string[];
  fn: (modules: object[]) => void;
}

const hotModulesMap = new Map<string, HotModule>();
// const disposeMap = new Map<string, (data: any) => void | Promise<void>>();
const pruneMap = new Map<string, (data: any) => void | Promise<void>>();

export const createHotContext = (ownerPath: string) => {
  const mod = hotModulesMap.get(ownerPath);
  if (mod) {
    mod.callbacks = [];
  }

  function acceptDeps(deps: string[], callback: any) {
    const mod: HotModule = hotModulesMap.get(ownerPath) || {
      id: ownerPath,
      callbacks: [],
    };
    mod.callbacks.push({
      deps,
      fn: callback,
    });
    hotModulesMap.set(ownerPath, mod);
  }

  return {
    accept(deps: any, callback?: any) {
      if (typeof deps === 'function' || !deps) {
        // self-accept: hot.accept(() => {})
        // @ts-ignore
        acceptDeps([ownerPath], ([mod]) => deps && deps(mod));
      }
      // TODO: more situations
    },
    prune(cb: (data: any) => void) {
      pruneMap.set(ownerPath, cb);
    },
  };
};

async function fetchUpdate({ path, acceptedPath, timestamp }: Update) {
  const mod = hotModulesMap.get(path);
  if (!mod) return;

  const moduleMap = new Map();
  const isSelfUpdate = path === acceptedPath;

  const modulesToUpdate = new Set<string>();
  if (isSelfUpdate) {
    // self update - only update self
    modulesToUpdate.add(path);
  } else {
    // TODO
  }

  const qualifiedCallbacks = mod.callbacks.filter(({ deps }) => {
    return deps.some((dep) => modulesToUpdate.has(dep));
  });

  const base = '/';
  await Promise.all(
    Array.from(modulesToUpdate).map(async (dep) => {
      const [path, query] = dep.split(`?`);
      try {
        const newMod = await import(
          base + path.slice(1) + `?t=${timestamp}${query ? `&${query}` : ''}`
        );
        moduleMap.set(dep, newMod);
      } catch (e) {}
    }),
  );

  return () => {
    for (const { deps, fn } of qualifiedCallbacks) {
      fn(deps.map((dep: any) => moduleMap.get(dep)));
    }
    const loggedPath = isSelfUpdate ? path : `${acceptedPath} via ${path}`;
    console.log(`[vite] hot updated: ${loggedPath}`);
  };
}

const sheetsMap = new Map();

export function updateStyle(id: string, content: string) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.innerHTML = content;
    document.head.appendChild(style);
  } else {
    style.innerHTML = content;
  }
  sheetsMap.set(id, style);
}

export function removeStyle(id: string): void {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
  }
  sheetsMap.delete(id);
}
