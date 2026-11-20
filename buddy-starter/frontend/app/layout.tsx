import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '../components/auth/AuthProvider';
export const metadata: Metadata = { title: 'Buddy — A little space to talk', description: 'An AI emotional support companion. Internal testing only.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><AuthProvider>{children}</AuthProvider></body></html>; }
