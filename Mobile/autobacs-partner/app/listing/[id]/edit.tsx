import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../../../src/api';
import { ListingEditor } from '../../../src/features/ListingEditor';
import { listingKey } from '../../../src/features/listingCache';
import { ErrorState, Loading } from '../../../src/ui';

export default function EditListing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Always start an edit from the server's latest copy (fresh rev), never a stale cache.
  const q = useQuery({ queryKey: listingKey(id), queryFn: () => api.getListing(id), staleTime: 0, refetchOnMount: 'always' });
  if (q.isPending || q.isRefetching) return <Loading />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return <ListingEditor key={`${q.data.id}:${q.data.rev}`} initial={q.data} />;
}
