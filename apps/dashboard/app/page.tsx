import { Category } from '@janawaaz/shared';

// Scaffold placeholder (I-01). The staff UI arrives in I-29 onwards.
export default function Home() {
  return (
    <main>
      <h1>Jan Awaaz — staff dashboard</h1>
      <p>Scaffold placeholder. Categories: {Category.options.join(', ')}</p>
    </main>
  );
}
