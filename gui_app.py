import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, Listbox
import requests
import os

SERVER_URL = 'http://localhost:3000'

class App:
    def __init__(self, root):
        self.root = root
        self.root.title("File Server Client")
        self.username = None
        self.password = None
        self.login_screen()

    def login_screen(self):
        for widget in self.root.winfo_children():
            widget.destroy()
        tk.Label(self.root, text="Username").pack()
        username_entry = tk.Entry(self.root)
        username_entry.pack()
        tk.Label(self.root, text="Password").pack()
        password_entry = tk.Entry(self.root, show="*")
        password_entry.pack()
        def login():
            self.username = username_entry.get()
            self.password = password_entry.get()
            if self.try_login():
                self.main_screen()
            else:
                messagebox.showerror("Login Failed", "Invalid credentials")
        tk.Button(self.root, text="Login", command=login).pack()

    def try_login(self):
        try:
            r = requests.get(SERVER_URL + '/files', headers={'username': self.username, 'password': self.password})
            return r.status_code == 200
        except:
            return False

    def main_screen(self):
        for widget in self.root.winfo_children():
            widget.destroy()
        tk.Button(self.root, text="Upload File", command=self.upload_file).pack()
        tk.Button(self.root, text="Refresh File List", command=self.refresh_files).pack()
        self.file_list = Listbox(self.root)
        self.file_list.pack(fill=tk.BOTH, expand=True)
        tk.Button(self.root, text="Download Selected", command=self.download_file).pack()
        self.refresh_files()

    def upload_file(self):
        file_path = filedialog.askopenfilename()
        if not file_path: return
        with open(file_path, 'rb') as f:
            files = {'file': (os.path.basename(file_path), f)}
            r = requests.post(SERVER_URL + '/upload', files=files, headers={'username': self.username, 'password': self.password})
            if r.status_code == 200:
                messagebox.showinfo("Success", "File uploaded")
                self.refresh_files()
            else:
                messagebox.showerror("Error", r.text)

    def refresh_files(self):
        r = requests.get(SERVER_URL + '/files', headers={'username': self.username, 'password': self.password})
        self.file_list.delete(0, tk.END)
        if r.status_code == 200:
            for fname in r.json():
                self.file_list.insert(tk.END, fname)

    def download_file(self):
        selection = self.file_list.curselection()
        if not selection: return
        fname = self.file_list.get(selection[0])
        r = requests.get(SERVER_URL + f'/download/{fname}', headers={'username': self.username, 'password': self.password}, stream=True)
        if r.status_code == 200:
            save_path = filedialog.asksaveasfilename(initialfile=fname)
            if save_path:
                with open(save_path, 'wb') as f:
                    for chunk in r.iter_content(1024):
                        f.write(chunk)
                messagebox.showinfo("Success", "File downloaded")
        else:
            messagebox.showerror("Error", r.text)

if __name__ == "__main__":
    root = tk.Tk()
    app = App(root)
    root.mainloop()
