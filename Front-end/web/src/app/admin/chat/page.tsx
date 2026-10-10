import { Suspense } from 'react';
import TeamChat from '@/components/chat/TeamChat';

export const metadata = { title: 'Team chat', robots: { index: false, follow: false } };

export default function AdminChatPage() {
  return (
    <Suspense fallback={null}>
      <TeamChat />
    </Suspense>
  );
}
