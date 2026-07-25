import { collection, doc, type CollectionReference, type DocumentData, type DocumentReference } from "firebase/firestore";
import { db } from "./firebase";

export type WorkspaceScope = {
  root: "users" | "schools";
  id: string;
};

export function workspaceCollection(scope: WorkspaceScope, name: string): CollectionReference<DocumentData> {
  return collection(db, scope.root, scope.id, name);
}

export function workspaceDoc(scope: WorkspaceScope, name: string, id: string): DocumentReference<DocumentData> {
  return doc(db, scope.root, scope.id, name, id);
}
