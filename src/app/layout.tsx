import type { Metadata } from 'next';
import './globals.css';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Supabase Control Hub', description: 'Controle privado de projetos, capacidade e continuidade.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
