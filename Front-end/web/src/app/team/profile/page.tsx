'use client';

import StaffProfileForm from '@/components/profile/StaffProfileForm';

/** My profile — a team member's own photo and details. */
export default function TeamProfilePage() {
  return <StaffProfileForm passwordHref="/team/password" />;
}
