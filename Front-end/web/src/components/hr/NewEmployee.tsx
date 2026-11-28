'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { hrApi } from '@/lib/hr/api';
import { hrKeys } from '@/lib/hr/keys';
import type { EmployeeInput } from '@/lib/hr/types';
import EmployeeForm from './EmployeeForm';
import { HrPageHeader, hrCard } from './HrStates';

export default function NewEmployee() {
  const router = useRouter();
  const qc = useQueryClient();
  const create = async (input: EmployeeInput) => {
    const { employee } = await hrApi.createEmployee(input);
    qc.setQueryData(hrKeys.employee(employee.id), { employee });
    qc.invalidateQueries({ queryKey: hrKeys.employees() });
    router.push(`/hr/employees/${employee.id}`);
  };
  return (
    <div className="max-w-3xl">
      <Link href="/hr/employees" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> All employees</Link>
      <HrPageHeader title="Add employee" sub="They get an EMP code and the onboarding checklist. Their login can be linked later." />
      <div className={`${hrCard} p-4`}>
        <EmployeeForm submitLabel="Add employee" onSubmit={create} onCancel={() => router.push('/hr/employees')} />
      </div>
    </div>
  );
}
