// src/store.js
import { createStore } from 'redux';

// Action Types
const LOGIN = 'auth/LOGIN';
const LOGOUT = 'auth/LOGOUT';
const SET_USER = 'auth/SET_USER';

// Action Creators
export const login = (token, user) => ({
  type: LOGIN,
  payload: { token, user },
});

export const logout = () => ({
  type: LOGOUT,
});

export const setUser = (user) => ({
  type: SET_USER,
  payload: user,
});

// Initial State
const initialState = {
  token: null,
  user: null,
  isAuthenticated: false,
};

// Reducer
function authReducer(state = initialState, action) {
  switch (action.type) {
    case LOGIN: {
      const { token, user } = action.payload;
      // Persist token and user
      localStorage.setItem('authToken', token);
      localStorage.setItem('authUser', JSON.stringify(user));
      return {
        ...state,
        token,
        user,
        isAuthenticated: true,
      };
    }
    case LOGOUT: {
      localStorage.removeItem('authToken');
      localStorage.removeItem('authUser');
      return {
        ...state,
        token: null,
        user: null,
        isAuthenticated: false,
      };
    }
    case SET_USER:
      return {
        ...state,
        user: action.payload,
        isAuthenticated: !!state.token,
      };
    default:
      return state;
  }
}

// Create store
export const store = createStore(authReducer);

// Helper to load persisted auth on app start
export const initializeAuth = () => {
  const token = localStorage.getItem('authToken');
  const user = localStorage.getItem('authUser');
  if (token && user) {
    store.dispatch(login(token, JSON.parse(user)));
  }
};