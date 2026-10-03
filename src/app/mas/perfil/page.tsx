import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import PerfilClient from './perfil-client';

export default async function PerfilPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, household_id, nickname, display_name')
    .eq('id', user.id)
    .single();

  if (!profile?.household_id) redirect('/household');

  const { data: household } = await supabase
    .from('households')
    .select('id, name')
    .eq('id', profile.household_id)
    .single();

  if (!household) redirect('/household');

  return (
    <PerfilClient
      profile={profile as Parameters<typeof PerfilClient>[0]['profile']}
      household={household}
    />
  );
}
