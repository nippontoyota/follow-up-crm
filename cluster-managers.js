export const CLUSTER_MANAGER_DEFINITIONS = [
  {
    username: 'biju.cluster1',
    legacyUsername: 'biju.cluster',
    name: 'Biju Cluster Manager',
    passwordEnv: 'CLUSTER_MANAGER_PASSWORD_BIJU',
    branches: ['Nippon Toyota - Kalamassery', 'Nippon Toyota - Nettoor', 'Nippon Toyota - Kayamkulam'],
  },
  {
    username: 'praveen.cluster2',
    legacyUsername: 'praveen.cluster',
    name: 'Praveen Cluster Manager',
    passwordEnv: 'CLUSTER_MANAGER_PASSWORD_PRAVEEN',
    branches: ['Nippon Toyota - Kazhakoottam', 'Nippon Toyota - Enjakkal', 'Nippon Toyota - Kollam'],
  },
  {
    username: 'vinod.cluster3',
    legacyUsername: 'vinod.cluster',
    name: 'Vinod Cluster Manager',
    passwordEnv: 'CLUSTER_MANAGER_PASSWORD_VINOD',
    branches: ['Nippon Toyota - Trichur', 'Nippon Toyota - Irinjalakuda', 'Nippon Toyota - Muvattupuzha'],
  },
  {
    username: 'nirmal.cluster4',
    legacyUsername: 'nirmal.cluster',
    name: 'Nirmal Cluster Manager',
    passwordEnv: 'CLUSTER_MANAGER_PASSWORD_NIRMAL',
    branches: ['Nippon Toyota - Kottayam', 'Nippon Toyota - Pala', 'Nippon Toyota - Pathanamthitta', 'Nippon Toyota - Thiruvalla'],
  },
];

export function getClusterManagerPassword(manager) {
  const password = String(process.env[manager.passwordEnv] || '');
  if (!password) throw new Error(`Missing required environment variable ${manager.passwordEnv}`);
  return password;
}
