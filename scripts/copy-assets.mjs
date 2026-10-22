import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
await mkdir(resolve(root, 'dist/renderer'), { recursive: true });
await cp(resolve(root, 'src/renderer'), resolve(root, 'dist/renderer'), { recursive: true });
await cp(resolve(root, 'assets/icon.png'), resolve(root, 'dist/icon.png'));
