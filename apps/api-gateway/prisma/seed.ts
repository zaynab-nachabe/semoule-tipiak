// Jeu de données de test — lot B, issue B1.
// Crée un trio lié : un senior, un proche (famille), un soignant (médical),
// tous deux reliés au senior par une relation consentie et active.
// Lancer avec : npx prisma db seed

import { PrismaClient, Role, ConsentStatus, Severity } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // --- Le senior (compte + profil) ---
  const seniorPerson = await prisma.person.create({
    data: {
      email: 'rene@example.com',
      passwordHash: 'dev-hash', // en dev seulement ; B2 gérera le vrai hachage
      fullName: 'René Dupont',
      role: Role.SENIOR,
      seniorProfile: { create: {} },
    },
    include: { seniorProfile: true },
  });
  const senior = seniorPerson.seniorProfile!;

  // --- Le proche (famille) ---
  const family = await prisma.person.create({
    data: {
      email: 'marie@example.com',
      passwordHash: 'dev-hash',
      fullName: 'Marie Dupont',
      role: Role.FAMILY,
    },
  });

  // --- Le soignant (médical) ---
  const medical = await prisma.person.create({
    data: {
      email: 'dr.martin@example.com',
      passwordHash: 'dev-hash',
      fullName: 'Dr Martin',
      role: Role.MEDICAL,
    },
  });

  // --- Les relations de suivi, consenties et actives ---
  await prisma.careRelationship.create({
    data: {
      seniorId: senior.id,
      caregiverId: family.id,
      relationType: Role.FAMILY,
      consentStatus: ConsentStatus.GRANTED,
      consentedAt: new Date(),
      createdBy: seniorPerson.id, // le senior a accordé l'accès
    },
  });

  await prisma.careRelationship.create({
    data: {
      seniorId: senior.id,
      caregiverId: medical.id,
      relationType: Role.MEDICAL,
      consentStatus: ConsentStatus.GRANTED,
      consentedAt: new Date(),
      createdBy: seniorPerson.id,
    },
  });

  // --- Un seuil et un contact d'exemple ---
  await prisma.toleranceThreshold.create({
    data: {
      seniorId: senior.id,
      condition: 'MAX_INACTIVITY_MINUTES',
      durationInMinutes: 120,
      severity: Severity.HIGH,
    },
  });

  await prisma.emergencyContact.create({
    data: {
      seniorId: senior.id,
      fullName: 'Marie Dupont',
      phone: '+33600000000',
      priority: 1,
    },
  });

  console.log('Seed terminé : 1 senior, 1 famille, 1 médical, 2 relations consenties.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
