'use client';

import { use } from 'react';
import PastMemberProfileView from '@/components/pastMembers/PastMemberProfile';

export default function PastMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PastMemberProfileView id={id} base="/admin/past-members" />;
}
