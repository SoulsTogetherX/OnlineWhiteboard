<p align="center">
  <a href="./LICENSE"> 
	<img alt="Static Badge" src="https://img.shields.io/badge/license-Apache%202.0-green">
  </a>
</p>

# Online Whiteboard

A real-time collaborative whiteboard web app where users can draw on a shared canvas and see updates broadcast live to everyone in the same room.
Built for desktop and mobile, with tools for freehand drawing, filling areas, and real-time collaboration.

<img width="1920" height="882" alt="Example Image" src="https://github.com/user-attachments/assets/764d1d05-62f6-45a1-9438-43840e77acf6" />

## Features

* Real-time shared drawing across users in the same room
* Desktop and mobile-friendly interface
* Live room-based synchronization
* Responsive UI for collaborative use

## Tech Stack

* Frontend: React + Vite
* Backend: Express + Node.js + WebSockets
* Database: PostgreSQL
* Language: TypeScript
* Deployment: Docker

## Requirements

* Docker Desktop or Docker Engine

## Running the project

This project is currently supported through Docker.

To use the project:

* Install Docker Desktop from their [official website](https://docs.docker.com/desktop/). Follow the setup instructions to get the application running on your machine.
* Clone the repository to your local machine.
* At the root of the repository, there should be a file named `.env.example`. Rename it to `.env` and open it in your text editor of choice.
* Set the environment variable `POSTGRES_PASSWORD` to a PostgreSQL password you have access to.
* While still in the root folder, open a terminal window and run the following command.

```bash
docker compose up --build
```

After building, open the app in your browser at the local address shown in the terminal.

## How to use

<img width="1280" height="720" alt="Example Image with listed terms" src="https://github.com/user-attachments/assets/290d0ae9-1e0c-4656-8ac5-d4c1dcc76b9d" />

### Terminology
The "ToolBar" contains a list of tools that you can access to interact with the application in a variety of ways. It is open by default on desktop platforms. On mobile platforms, you can open it by pressing the hamburger button in the top-left.

The "Room Selector" is where you can change rooms. Pressing it will open a popup, asking for a new room id to enter.

The "Tools" are the drawing/action buttons. Pressing one will change how you interact with the "Canvas". Hovering over them will reveal their name.

The "Canvas" displays and allows users to edit the current room’s drawing.

The "Color Picker" allows you to switch between primary/secondary colors, or change the primary/secondary colors. Click on the Brush to swap the primary and secondary. Click on the colored rectangle to open a popup to change that color.

The "Room Info" shows the current room details.

### Desktop Shortcuts
* Left-click will use the primary color, while right-click will use the secondary color.

More shortcuts will be added in the future.

## How it works

The application uses a client-server architecture.

When a user joins a room, the backend loads the room state from cache or database and sends it to the client. Drawing actions are converted into events and broadcast to other connected users in the same room. Each client applies those events locally so the Canvas stays synchronized across all users. Room state is periodically saved to the database to prevent data loss.

## Project structure

This is a monorepo full-stack application. All server-side and client-side code is shared here.

The "backend" folder holds all server logic, and acts as a mediator for any client accessing the database.

The "frontend" folder holds all frontend code, used for user interactions.

The "shared" folder is accessed by both the "backend" and "frontend" folders to handle drawing protocols and defines basic types.

The "database" folder holds the schema for the PostgreSQL database used.

## Future improvements

* Undo/redo
* Eyedropper Tool 
* Stroke Size Controls
* Shortcuts
* Add a button to hide/show Room information.
* Include an icon that displays what tool is currently selected.
* Set the Room ID prompt to match the current room by default
* Export/import Canvas
* Prompt for a room ID before loading the Canvas (i.e., removing the default 'TestRoom').
