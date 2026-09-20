import './globals.css';
import { Inter, Playfair_Display } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

// The wordmark font. Was Great Vibes — an English calligraphy script whose
// heavy loops turn a Somali name into something close to unreadable at any
// size. Playfair Display is the high-contrast serif used across tailoring and
// fashion brands: still elegant, but every letter is legible, which matters
// when the name is printed on receipts and statements customers keep.
// The CSS variable name is unchanged so nothing else needed touching.
const display = Playfair_Display({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-script',
  display: 'swap',
});

export const metadata = {
  title: 'Nidaamka Harqaanka',
  description: 'Orders, fabrics, customers and finance for a tailoring business',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
