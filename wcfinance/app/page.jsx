import { redirect } from 'next/navigation';

/**
 * The shipped UI is the single-file app in public/app.html. Serving it from the
 * Next process means one container, one origin and one TLS certificate.
 * Replace this redirect as screens are ported to server-rendered routes.
 */
export default function Home() {
  redirect('/app.html');
}
