import type { EmailDriver } from './types';

let emailSeq = 0;

/** Driver offline: mencatat email ke log (demo) tanpa mengirim apa pun. */
export class StubEmail implements EmailDriver {
  readonly driver = 'stub';
  readonly sent: Array<{ to: string; subject: string; id: string }> = [];

  async send(input: {
    to: string;
    subject: string;
    body: string;
  }): Promise<{ sent: boolean; id: string }> {
    emailSeq += 1;
    const id = `stub_email_${emailSeq}`;
    this.sent.push({ to: input.to, subject: input.subject, id });
    console.log(`[email:stub] → ${input.to} · "${input.subject}" (${id})`);
    return { sent: true, id };
  }
}

/** Driver produksi: Resend API (PRD §3.4 welcome email). Butuh RESEND_API_KEY. */
export class ResendEmail implements EmailDriver {
  readonly driver = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from = 'AutoOffice3D <onboarding@resend.dev>',
  ) {}

  async send(input: {
    to: string;
    subject: string;
    body: string;
  }): Promise<{ sent: boolean; id: string }> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [input.to],
        subject: input.subject,
        text: input.body,
      }),
    });
    if (!res.ok) return { sent: false, id: '' };
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: data.id ?? '' };
  }
}

export type { EmailDriver } from './types';
