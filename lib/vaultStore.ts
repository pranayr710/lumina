import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Credential {
  id: string;
  name: string;
  type: 'discord' | 'slack' | 'twilio' | 'email' | 'google';
  value: string; // The secret key/webhook URL
}

interface VaultState {
  credentials: Credential[];
  addCredential: (cred: Omit<Credential, 'id'>) => void;
  removeCredential: (id: string) => void;
  getCredentialValue: (name: string) => string | undefined;
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      credentials: [],
      addCredential: (cred) => set((state) => ({
        credentials: [...state.credentials, { ...cred, id: Math.random().toString(36).substr(2, 9) }]
      })),
      removeCredential: (id) => set((state) => ({
        credentials: state.credentials.filter((c) => c.id !== id)
      })),
      getCredentialValue: (name) => {
        const cred = get().credentials.find((c) => c.name === name);
        return cred?.value;
      },
    }),
    {
      name: 'lumina-vault',
    }
  )
);
