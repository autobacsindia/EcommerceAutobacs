/**
 * "Sign out?" with a warning when clock punches are still waiting to be sent
 * (they would be lost). Shared by the header avatar and the Me tab.
 */
import { Alert } from 'react-native';
import { queue, challengePool } from '../punch/PunchProvider';
import type { Employee } from '../api';

export async function confirmSignOut(employee: Employee, signOut: (beforeClear?: () => Promise<void>) => Promise<void>): Promise<void> {
  const waiting = await queue.pendingCount(employee.id);
  const drop = async () => {
    await queue.discardFor(employee.id);
    await challengePool.clear();
  };
  Alert.alert(
    'Sign out?',
    waiting
      ? `${waiting} clock ${waiting === 1 ? 'punch has' : 'punches have'} not been sent yet and will be lost. Ask HR to fix the day if you sign out now.`
      : `${employee.name} · ${employee.employeeCode}`,
    [
      { text: 'Stay', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut(drop) },
    ],
  );
}
