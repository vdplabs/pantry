import { createRxDatabase, addRxPlugin, type RxDatabase, type RxCollection } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { RxDBLeaderElectionPlugin } from 'rxdb/plugins/leader-election';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';
import { RxDBCleanupPlugin } from 'rxdb/plugins/cleanup';
import { RxDBLocalDocumentsPlugin } from 'rxdb/plugins/local-documents';
import { RxDBAttachmentsPlugin } from 'rxdb/plugins/attachments';
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema';
import type { Conversation, Generation } from '@/types';

export interface AppSettings {
  id: string;
  key: string;
  value: string;
}

const DB_NAME = 'pantry-db';

export let database: RxDatabase | null = null;
export let dbReady = false;

export async function initDatabase(): Promise<RxDatabase> {
  if (database && dbReady) return database;

  try {
    addRxPlugin(RxDBLeaderElectionPlugin);
    addRxPlugin(RxDBQueryBuilderPlugin);
    addRxPlugin(RxDBUpdatePlugin);
    addRxPlugin(RxDBCleanupPlugin);
    addRxPlugin(RxDBLocalDocumentsPlugin);
    addRxPlugin(RxDBAttachmentsPlugin);
    addRxPlugin(RxDBMigrationSchemaPlugin);
  } catch {
    // Plugins might already be added
  }

  if (!database) {
    database = await createRxDatabase({
      name: DB_NAME,
      storage: getRxStorageDexie(),
      closeDuplicates: true,
    });
  }

  const existingCollections = Object.keys((database as any).collections || {});

  if (!existingCollections.includes('conversations')) {
    await database.addCollections({
      conversations: {
        schema: conversationSchema,
        migrationStrategies: {
          1: (oldDoc: any) => ({
            ...oldDoc,
            plugin_id: oldDoc.plugin_id,
            plugin_framework: oldDoc.plugin_framework,
            canvas_state: oldDoc.canvas_state,
          }),
        },
      },
    });
  }

  if (!existingCollections.includes('generations')) {
    await database.addCollections({
      generations: {
        schema: generationSchema,
      },
    });
  }

  if (!existingCollections.includes('settings')) {
    await database.addCollections({
      settings: {
        schema: settingsSchema,
      },
    });
  }

  dbReady = true;
  return database;
}

export function getDb(): RxDatabase {
  if (!database || !dbReady) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return database;
}

export function getCollection<T>(name: string): RxCollection<T, {}, {}, {}, unknown> {
  const db = getDb();
  const coll = (db as any).collections[name];
  if (!coll) {
    console.error('getCollection: collection not found:', name);
    throw new Error(`Collection not found: ${name}`);
  }
  return coll;
}

export const conversationSchema = {
  version: 1,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    title: { type: 'string' },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
    message_count: { type: 'number' },
    model: { type: 'string' },
    plugin_id: { type: 'string' },
    plugin_framework: { type: 'string' },
    canvas_state: { type: 'object' },
    messages: {
      type: 'array',
      items: {
        type: 'object',
      },
    },
  },
  required: ['id', 'title', 'created_at', 'updated_at', 'message_count', 'model', 'messages'],
} as const;

export const generationSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    type: { type: 'string' },
    prompt: { type: 'string' },
    result: { type: 'string' },
    createdAt: { type: 'string' },
    model: { type: 'string' },
  },
  required: ['id', 'type', 'prompt', 'result', 'createdAt', 'model'],
} as const;

export const settingsSchema = {
  version: 0,
  primaryKey: 'key',
  type: 'object',
  properties: {
    key: { type: 'string', maxLength: 100 },
    value: { type: 'string' },
  },
  required: ['key', 'value'],
} as const;

export async function loadConversationsFromDb(): Promise<Conversation[]> {
  const coll = getCollection<Conversation>('conversations');
  const docs = await coll.find().exec();
  return docs.map(d => d.toJSON() as Conversation);
}

export async function saveConversationToDb(conv: Conversation): Promise<void> {
  const coll = getCollection<Conversation>('conversations');
  await coll.upsert(conv as any);
}

export async function deleteConversationFromDb(id: string): Promise<void> {
  const coll = getCollection<Conversation>('conversations');
  const doc = await coll.findOne(id).exec();
  if (doc) {
    await doc.remove();
  }
}

export async function loadGenerationsFromDb(): Promise<Generation[]> {
  const coll = getCollection<Generation>('generations');
  const docs = await coll.find().exec();
  return docs.map(d => d.toJSON() as Generation);
}

export async function saveGenerationToDb(gen: Generation): Promise<void> {
  const coll = getCollection<Generation>('generations');
  await coll.upsert(gen as any);
}

export async function deleteGenerationFromDb(id: string): Promise<void> {
  const coll = getCollection<Generation>('generations');
  const doc = await coll.findOne(id).exec();
  if (doc) {
    await doc.remove();
  }
}

export async function getSetting(key: string): Promise<string | null> {
  const coll = getCollection<AppSettings>('settings');
  const doc = await coll.findOne(key).exec();
  return doc ? doc.value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const coll = getCollection<AppSettings>('settings');
  await coll.upsert({ id: key, key, value } as any);
}

export async function removeSetting(key: string): Promise<void> {
  const coll = getCollection<AppSettings>('settings');
  const doc = await coll.findOne(key).exec();
  if (doc) {
    await doc.remove();
  }
}
