import { redirect } from 'next/navigation';

/**
 * Tab "Briefing Room" sudah tidak ada — chat PM kini menyatu sebagai floating
 * dock di Office Theater (kiri-bawah, di bawah Agent Division Sidebar).
 * Route lama tetap hidup sebagai redirect agar deep-link/riwayat tidak 404.
 */
export default function BriefingPage(): never {
  redirect('/');
}
