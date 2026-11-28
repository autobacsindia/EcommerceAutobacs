import EmployeeDetail from '@/components/hr/EmployeeDetail';

export default async function HrEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmployeeDetail id={id} />;
}
