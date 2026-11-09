'use client';

import { useRouter } from 'next/navigation';
import LessonForm from './LessonForm';
import { useCreateLesson } from './hooks';

/** After saving, the lesson's own page: that is where files are added. */
export default function NewLesson({ base }: { base: string }) {
  const router = useRouter();
  const create = useCreateLesson();
  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold text-gray-900">Post a lesson</h1>
      <LessonForm
        canManage
        submitLabel="Save and add files"
        initial={{ title: '', body: '', topic: '', audience: '', ownerId: '' }}
        onCancel={() => router.push(base)}
        onSubmit={async (draft) => {
          const lesson = await create.mutateAsync(draft);
          router.push(`${base}/${lesson.id}`);
        }}
      />
    </div>
  );
}
