import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
await mkdir(resolve(root, 'dist/renderer'), { recursive: true });
await cp(resolve(root, 'src/renderer'), resolve(root, 'dist/renderer'), { recursive: true });
await cp(resolve(root, 'assets/icon.png'), resolve(root, 'dist/icon.png'));
