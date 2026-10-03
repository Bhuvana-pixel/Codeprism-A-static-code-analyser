<?php

namespace App\Http\Controllers;

class UserController {
    public function show($id) {
        return response()->json(["user_id" => $id]);
    }
}
