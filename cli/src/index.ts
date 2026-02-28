import { intro, outro, text, isCancel, cancel, spinner, multiselect } from '@clack/prompts';
import color from 'picocolors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function main() {
  intro(color.bgCyan(color.black(' create-max-stack ')));

  const projectName = (await text({
    message: 'What is your project named?',
    placeholder: 'my-max-stack-app',
    validate(value) {
      if (!value || value.length === 0) return `Value is required!`;
      if (fs.existsSync(path.join(process.cwd(), value))) {
        return `Directory "${value}" already exists!`;
      }
    },
  })) as string;

  if (isCancel(projectName)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }

  const features = (await multiselect({
    message: 'Select features to include:',
    options: [
      { value: 'auth', label: 'Authentication (Clerk)'},
      { value: 'db', label: 'Database (Neon + Drizzle)'},
      { value: 'base-ui', label: 'Base UI' },
    ],
    initialValues: ['base-ui'],
  })) as string[];

  if (isCancel(features)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }

  const useAuth = features.includes('auth');
  const useDb = features.includes('db');
  const useBaseUi = features.includes('base-ui');

  const s = spinner();
  s.start('Scaffolding project...');

  const targetDir = path.join(process.cwd(), projectName);
  const templateDir = path.resolve(__dirname, '../../template');

  // 1. Copy template
  fs.cpSync(templateDir, targetDir, { recursive: true });

  // 2. Handle gitignore (npm renames .gitignore to .npmignore on publish)
  const gitignorePath = path.join(targetDir, 'gitignore');
  const dotGitignorePath = path.join(targetDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    fs.renameSync(gitignorePath, dotGitignorePath);
  }

  // 3. Modify package.json
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkg.name = projectName;

  if (!useAuth) {
    delete pkg.dependencies['@clerk/nextjs'];
    // Remove middleware if no auth
    const middlewarePath = path.join(targetDir, 'src/middleware.ts');
    if (fs.existsSync(middlewarePath)) {
      fs.unlinkSync(middlewarePath);
    }
  }

  if (!useDb) {
    delete pkg.dependencies['drizzle-orm'];
    delete pkg.dependencies['@neondatabase/serverless'];
    delete pkg.dependencies['dotenv'];
    delete pkg.devDependencies['drizzle-kit'];
    // Remove db directory and config if no db
    const dbDir = path.join(targetDir, 'src/db');
    if (fs.existsSync(dbDir)) {
      fs.rmSync(dbDir, { recursive: true });
    }
    const drizzleConfig = path.join(targetDir, 'drizzle.config.ts');
    if (fs.existsSync(drizzleConfig)) {
      fs.unlinkSync(drizzleConfig);
    }
  }

  if (!useBaseUi) {
    delete pkg.dependencies['@base-ui-components/react'];
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  // 4. Create .env file
  let envContent = '';
  if (useAuth) {
    envContent += `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=\nCLERK_SECRET_KEY=\n`;
  }
  if (useDb) {
    envContent += `DATABASE_URL=\n`;
  }
  if (envContent) {
    fs.writeFileSync(path.join(targetDir, '.env.example'), envContent);
    fs.writeFileSync(path.join(targetDir, '.env.development.local'), envContent);
    fs.writeFileSync(path.join(targetDir, '.env.production'), envContent);
  }

  // 4.1 Add auth setup notes if Clerk is selected
  if (useAuth) {
    const readmePath = path.join(targetDir, 'README.md');
    if (fs.existsSync(readmePath)) {
      const authSetupNote = `
## Clerk Setup

To use Clerk auth, wrap your app with \`ClerkProvider\` in \`src/app/layout.tsx\`.

\`\`\`tsx
import { ClerkProvider } from '@clerk/nextjs';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
\`\`\`

<br />

Add a proxy.ts file to the src directory like so. Update the route matcher to match your public routes.
\`\`\`tsx
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)'])

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
  };
  
\`\`\`

<br/>

Update your .env files with your Clerk publishable and secret keys.
\`\`\`env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
\`\`\`
`;
      fs.appendFileSync(readmePath, authSetupNote);
    }
  }

  // 5. Initialize git
  s.message('Initializing git repository...');
  try {
    await runCommand('git', ['init'], targetDir);
  } catch (e) {
    // Ignore git init errors
  }

  // 6. Install dependencies
  s.message('Installing dependencies (this may take a minute)...');
  let installFailed = false;
  try {
    await runCommand('npm', ['install'], targetDir);
  } catch (e) {
    installFailed = true;
  }

  if (installFailed) {
    s.stop(color.yellow('Project scaffolded, but npm install failed.'));
  } else {
    s.stop('Project scaffolded!');
  }

  outro(color.green(`Project ${projectName} created successfully!`));
  if (installFailed) {
    console.log(`\nNext steps:\n  cd ${projectName}\n  npm install\n  npm run dev\n`);
    return;
  }
  console.log(`\nNext steps:\n  cd ${projectName}\n  npm run dev\n`);
}

main().catch(console.error);
