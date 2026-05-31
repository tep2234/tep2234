'use client';
import { useState, useEffect } from 'react';
import { Class } from '@/types';
import { getAll, save, generateId, STORAGE_KEYS } from '@/lib/storage';

export function useClasses() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setClasses(getAll<Class>(STORAGE_KEYS.CLASSES));
    setLoaded(true);
  }, []);

  const persist = (updated: Class[]) => {
    setClasses(updated);
    save(STORAGE_KEYS.CLASSES, updated);
  };

  const addClass = (data: Omit<Class, 'id' | 'createdAt'>) => {
    const newClass: Class = {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    persist([...classes, newClass]);
    return newClass;
  };

  const updateClass = (id: string, data: Partial<Class>) => {
    persist(classes.map(c => c.id === id ? { ...c, ...data } : c));
  };

  const deleteClass = (id: string) => {
    persist(classes.filter(c => c.id !== id));
  };

  const toggleStar = (id: string) => {
    persist(classes.map(c => c.id === id ? { ...c, starred: !c.starred } : c));
  };

  const getClass = (id: string) => classes.find(c => c.id === id);

  return { classes, loaded, addClass, updateClass, deleteClass, toggleStar, getClass };
}
