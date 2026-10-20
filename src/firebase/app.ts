import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';
import { firebaseOptionsFromEnv } from './config';

export interface FirebaseHandles {
  db: Database;
  /** 匿名ログインのユーザー ID */
  uid: string;
}

/** Firebase を初期化し、匿名ログインする（技術検証用。本番のログインはフェーズ2で作る） */
export async function connectFirebase(): Promise<FirebaseHandles> {
  const options = firebaseOptionsFromEnv();
  if (!options) throw new Error('Firebase の設定値がありません（.env.local）');
  const app = initializeApp(options);
  const cred = await signInAnonymously(getAuth(app));
  return { db: getDatabase(app), uid: cred.user.uid };
}
