import Link from 'next/link';

export default function Settings() {
  return <main className="centerPage"><section className="authCard"><Link className="back" href="/chat?mode=account">← Back to chat</Link><h1>Your settings</h1><p>Control whether Buddy can automatically save suitable details from account conversations.</p><Link className="primary" href="/memories">Review memory and consent settings</Link><p className="note">Buddy is AI, not a therapist. Account deletion will be available after the coordinated Firebase and database deletion workflow is configured.</p></section></main>;
}
