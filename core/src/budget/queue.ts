import type { Task } from '../models.ts';

export interface QueuedTask {
  id: string;
  task: Task;
  input: unknown;
  createdAt: number;
  resumeAt: number;
}

/** Tasks that could not run because the budget window is exhausted. They resume automatically. */
export class TaskQueue {
  constructor(public items: QueuedTask[] = []) {}

  add(task: Task, input: unknown, resumeAt: number, now = Date.now()): QueuedTask {
    const item: QueuedTask = { id: crypto.randomUUID(), task, input, createdAt: now, resumeAt };
    this.items.push(item);
    return item;
  }

  due(now = Date.now()): QueuedTask[] {
    return this.items.filter((i) => i.resumeAt <= now);
  }

  remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
  }
}
