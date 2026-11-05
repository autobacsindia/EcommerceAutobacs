import { Suspense } from 'react';
import TeamChat from '@/components/chat/TeamChat';
import { chatFont } from '@/lib/chatFont';

export const metadata = { title: 'Team chat', robots: { index: false, follow: false } };

export default function TeamChatPage() {
  return (
    <Suspense fallback={null}>
      <TeamChat fontClassName={chatFont.variable} />
    </Suspense>
  );
}
