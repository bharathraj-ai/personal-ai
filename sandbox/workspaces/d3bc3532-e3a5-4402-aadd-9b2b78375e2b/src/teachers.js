const express = require('express');
const router = express.Router();
const db = require('../db'); // Assumed generic DB helper

// GET /teachers - list all teachers
router.get('/', async (req, res) => {
  try {
    const teachers = await db.getAll('teachers');
    res.json(teachers);
  } catch (err) {
    console.error('Error fetching teachers:', err);
    res.status(500).json({ error: 'Failed to retrieve teachers' });
  }
});

// GET /teachers/:id - get a single teacher by id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const teacher = await db.get('teachers', id);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }
    res.json(teacher);
  } catch (err) {
    console.error(`Error fetching teacher ${id}:`, err);
    res.status(500).json({ error: 'Failed to retrieve teacher' });
  }
});

// POST /teachers - create a new teacher
router.post('/', async (req, res) => {
  const newTeacher = req.body;
  try {
    const created = await db.create('teachers', newTeacher);
    res.status(201).json(created);
  } catch (err) {
    console.error('Error creating teacher:', err);
    res.status(500).json({ error: 'Failed to create teacher' });
  }
});

// PUT /teachers/:id - update an existing teacher
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  try {
    const updated = await db.update('teachers', id, updates);
    if (!updated) {
      return res.status(404).json({ error: 'Teacher not found' });
    }
    res.json(updated);
  } catch (err) {
    console.error(`Error updating teacher ${id}:`, err);
    res.status(500).json({ error: 'Failed to update teacher' });
  }
});

// DELETE /teachers/:id - remove a teacher
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const deleted = await db.delete('teachers', id);
    if (!deleted) {
      return res.status(404).json({ error: 'Teacher not found' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(`Error deleting teacher ${id}:`, err);
    res.status(500).json({ error: 'Failed to delete teacher' });
  }
});

module.exports = router;
